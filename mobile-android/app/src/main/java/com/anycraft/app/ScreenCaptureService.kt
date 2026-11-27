package com.anycraft.app

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.Base64
import java.io.ByteArrayOutputStream

class ScreenCaptureService : Service() {

    companion object {
        const val ACTION_START = "com.anycraft.app.START_CAPTURE"
        const val ACTION_STOP = "com.anycraft.app.STOP_CAPTURE"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_DATA = "data"
        private const val CHANNEL_ID = "anycraft_screen_share"
        private const val NOTIF_ID = 1001

        var onFrame: ((String, Int, Int) -> Unit)? = null
    }

    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var workerThread: HandlerThread? = null
    private var workerHandler: Handler? = null
    private var lastFrameMs = 0L

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            cleanup()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            cleanup()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        if (intent?.action == ACTION_START) {
            startForegroundNotif()
            val code = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
            @Suppress("DEPRECATION")
            val data: Intent? = intent.getParcelableExtra(EXTRA_DATA)
            if (code == Activity.RESULT_OK && data != null) {
                startProjection(code, data)
            }
        }
        return START_NOT_STICKY
    }

    private fun startForegroundNotif() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val ch = NotificationChannel(
                CHANNEL_ID,
                "AnyCraft Screen Sharing",
                NotificationManager.IMPORTANCE_LOW
            )
            nm.createNotificationChannel(ch)
        }
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        val notif = builder
            .setContentTitle("AnyCraft Screen Share")
            .setContentText("Sharing your screen via low-latency P2P")
            .setSmallIcon(R.drawable.ic_launcher)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIF_ID,
                notif,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            )
        } else {
            startForeground(NOTIF_ID, notif)
        }
    }

    private fun startProjection(resultCode: Int, data: Intent) {
        cleanup()
        val mgr = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projection = mgr.getMediaProjection(resultCode, data)

        val metrics = resources.displayMetrics
        val scale = if (metrics.widthPixels > 720) 720f / metrics.widthPixels else 1f
        val width = (metrics.widthPixels * scale).toInt().coerceAtLeast(360)
        val height = (metrics.heightPixels * scale).toInt().coerceAtLeast(640)
        val density = metrics.densityDpi

        workerThread = HandlerThread("AnyCraftCapture").apply { start() }
        workerHandler = Handler(workerThread!!.looper)

        // Required on Android 14+ (API 34) before createVirtualDisplay
        projection?.registerCallback(projectionCallback, workerHandler)

        imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        imageReader?.setOnImageAvailableListener({ reader ->
            val now = System.currentTimeMillis()
            val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener
            try {
                // Cap at ~24 fps for smooth low-latency WebView transfer
                if (now - lastFrameMs < 40) return@setOnImageAvailableListener
                lastFrameMs = now

                val plane = image.planes[0]
                val buffer = plane.buffer
                val pixelStride = plane.pixelStride
                val rowStride = plane.rowStride
                val rowPadding = rowStride - pixelStride * width

                val bmp = Bitmap.createBitmap(
                    width + rowPadding / pixelStride,
                    height,
                    Bitmap.Config.ARGB_8888
                )
                bmp.copyPixelsFromBuffer(buffer)
                val cropped = if (rowPadding > 0) {
                    Bitmap.createBitmap(bmp, 0, 0, width, height).also { bmp.recycle() }
                } else {
                    bmp
                }

                val out = ByteArrayOutputStream()
                cropped.compress(Bitmap.CompressFormat.JPEG, 68, out)
                cropped.recycle()
                val b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
                onFrame?.invoke(b64, width, height)
            } finally {
                image.close()
            }
        }, workerHandler)

        virtualDisplay = projection?.createVirtualDisplay(
            "AnyCraftDisplay",
            width,
            height,
            density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader?.surface,
            null,
            workerHandler
        )
    }

    private fun cleanup() {
        virtualDisplay?.release()
        virtualDisplay = null
        imageReader?.close()
        imageReader = null
        try {
            projection?.unregisterCallback(projectionCallback)
        } catch (_: Exception) {}
        projection?.stop()
        projection = null
        workerThread?.quitSafely()
        workerThread = null
        workerHandler = null
    }

    override fun onDestroy() {
        cleanup()
        super.onDestroy()
    }
}
