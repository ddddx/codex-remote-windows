package com.example.codex_remote_mobile

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.OpenableColumns
import android.provider.Settings
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.BufferedInputStream
import java.io.File
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.min

class MainActivity : FlutterActivity() {
    private val channelName = "codex_remote_mobile/native"
    private val preferencesName = "codex_remote_mobile"
    private val pickImageRequestCode = 42017
    private val notificationPermissionRequestCode = 42019
    private val taskNotificationChannelId = "codex_remote_task_events"
    private val downloadExecutor = Executors.newSingleThreadExecutor()
    private val maxDownloadConnections = 4
    private val acceleratedDownloadMinBytes = 8L * 1024L * 1024L
    private val progressIntervalMs = 250L
    private var pendingPickResult: MethodChannel.Result? = null
    private lateinit var nativeChannel: MethodChannel

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        nativeChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
        nativeChannel.setMethodCallHandler { call, result ->
            when (call.method) {
                "getString" -> getStringValue(call, result)
                "setString" -> setStringValue(call, result)
                "remove" -> removeValue(call, result)
                "pickImage" -> pickImage(result)
                "getAppVersion" -> getAppVersion(result)
                "openUrl" -> openUrl(call, result)
                "downloadAndInstallApk" -> downloadAndInstallApk(call, result)
                "startBackgroundKeepAlive" -> startBackgroundKeepAlive(call, result)
                "stopBackgroundKeepAlive" -> stopBackgroundKeepAlive(result)
                "requestNotificationPermission" -> requestNotificationPermission(result)
                "showNotification" -> showNotification(call, result)
                else -> result.notImplemented()
            }
        }
    }

    private fun getStringValue(call: MethodCall, result: MethodChannel.Result) {
        val key = call.argument<String>("key")
        if (key.isNullOrBlank()) {
            result.error("invalid_key", "Missing preference key", null)
            return
        }
        result.success(preferences.getString(key, null))
    }

    private fun setStringValue(call: MethodCall, result: MethodChannel.Result) {
        val key = call.argument<String>("key")
        val value = call.argument<String>("value")
        if (key.isNullOrBlank()) {
            result.error("invalid_key", "Missing preference key", null)
            return
        }
        preferences.edit().putString(key, value.orEmpty()).apply()
        result.success(null)
    }

    private fun removeValue(call: MethodCall, result: MethodChannel.Result) {
        val key = call.argument<String>("key")
        if (key.isNullOrBlank()) {
            result.error("invalid_key", "Missing preference key", null)
            return
        }
        preferences.edit().remove(key).apply()
        result.success(null)
    }

    private fun pickImage(result: MethodChannel.Result) {
        if (pendingPickResult != null) {
            result.error("picker_active", "Image picker is already active", null)
            return
        }
        pendingPickResult = result
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/*"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/png", "image/jpeg", "image/webp", "image/gif"))
        }
        try {
            startActivityForResult(intent, pickImageRequestCode)
        } catch (_: ActivityNotFoundException) {
            val fallback = Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "image/*"
            }
            try {
                startActivityForResult(fallback, pickImageRequestCode)
            } catch (error: ActivityNotFoundException) {
                pendingPickResult = null
                result.error("picker_unavailable", error.message, null)
            }
        }
    }

    private fun getAppVersion(result: MethodChannel.Result) {
        try {
            val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packageManager.getPackageInfo(packageName, android.content.pm.PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                packageManager.getPackageInfo(packageName, 0)
            }
            val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                packageInfo.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                packageInfo.versionCode.toLong()
            }
            result.success(
                mapOf(
                    "packageName" to packageName,
                    "versionName" to (packageInfo.versionName ?: ""),
                    "versionCode" to versionCode,
                )
            )
        } catch (error: Exception) {
            result.error("version_unavailable", error.message, null)
        }
    }

    private fun openUrl(call: MethodCall, result: MethodChannel.Result) {
        val url = call.argument<String>("url")?.trim()
        if (url.isNullOrBlank()) {
            result.error("invalid_url", "Missing URL", null)
            return
        }
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
            result.success(null)
        } catch (error: Exception) {
            result.error("open_url_failed", error.message, null)
        }
    }

    private fun downloadAndInstallApk(call: MethodCall, result: MethodChannel.Result) {
        val url = call.argument<String>("url")?.trim()
        val requestedName = call.argument<String>("fileName")?.trim()
        if (url.isNullOrBlank()) {
            result.error("invalid_url", "Missing APK URL", null)
            return
        }
        val fileName = sanitizeApkName(requestedName)
        downloadExecutor.execute {
            try {
                val apkFile = downloadApk(url, fileName)
                runOnUiThread {
                    try {
                        emitDownloadProgress(
                            status = "installing",
                            url = url,
                            fileName = fileName,
                            downloadedBytes = apkFile.length(),
                            totalBytes = apkFile.length(),
                            bytesPerSecond = 0,
                            accelerated = false,
                            connections = 1,
                        )
                        installApk(apkFile)
                        result.success(null)
                    } catch (error: Exception) {
                        result.error("install_failed", error.message, null)
                    }
                }
            } catch (error: Exception) {
                runOnUiThread {
                    result.error("download_failed", error.message, null)
                }
            }
        }
    }

    private fun startBackgroundKeepAlive(call: MethodCall, result: MethodChannel.Result) {
        val title = call.argument<String>("title") ?: "Codex Remote"
        val body = call.argument<String>("body") ?: "后台保持连接中"
        try {
            KeepAliveService.start(this, title, body)
            result.success(null)
        } catch (error: Exception) {
            result.error("keep_alive_failed", error.message, null)
        }
    }

    private fun stopBackgroundKeepAlive(result: MethodChannel.Result) {
        try {
            KeepAliveService.stop(this)
            result.success(null)
        } catch (error: Exception) {
            result.error("keep_alive_stop_failed", error.message, null)
        }
    }

    private fun requestNotificationPermission(result: MethodChannel.Result) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        ) {
            result.success(null)
            return
        }
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), notificationPermissionRequestCode)
        result.success(null)
    }

    private fun showNotification(call: MethodCall, result: MethodChannel.Result) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            result.error("notification_permission_denied", "通知权限未开启", null)
            return
        }
        val title = call.argument<String>("title")?.takeIf { it.isNotBlank() } ?: "Codex Remote"
        val body = call.argument<String>("body")?.takeIf { it.isNotBlank() } ?: "任务已完成"
        val id = call.argument<Int>("id") ?: 42020
        try {
            createTaskNotificationChannel()
            val manager = getSystemService(NotificationManager::class.java)
            manager.notify(id, buildTaskNotification(title, body))
            result.success(null)
        } catch (error: Exception) {
            result.error("notification_failed", error.message, null)
        }
    }

    private fun createTaskNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            taskNotificationChannelId,
            "Codex Remote 任务通知",
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = "Codex 任务完成提醒"
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildTaskNotification(title: String, body: String): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        } ?: Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, taskNotificationChannelId)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()
    }

    private fun sanitizeApkName(value: String?): String {
        val clean = value
            ?.replace(Regex("[^A-Za-z0-9._-]"), "-")
            ?.takeIf { it.isNotBlank() }
            ?: "codex-remote-update.apk"
        return if (clean.endsWith(".apk", ignoreCase = true)) clean else "$clean.apk"
    }

    private fun downloadApk(url: String, fileName: String): File {
        val downloadsDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: cacheDir
        if (!downloadsDir.exists()) {
            downloadsDir.mkdirs()
        }
        val target = File(downloadsDir, fileName)
        val temp = File(downloadsDir, "$fileName.part")
        if (temp.exists()) {
            temp.delete()
        }
        emitDownloadProgress(
            status = "preparing",
            url = url,
            fileName = fileName,
            downloadedBytes = 0,
            totalBytes = 0,
            bytesPerSecond = 0,
            accelerated = false,
            connections = 1,
        )
        val metadata = fetchDownloadMetadata(url)
        try {
            val rangeDownloaded = metadata.supportsRanges &&
                metadata.contentLength >= acceleratedDownloadMinBytes &&
                downloadApkWithRanges(url, fileName, temp, metadata.contentLength)
            if (!rangeDownloaded) {
                downloadApkSingle(url, fileName, temp, metadata.contentLength)
            }
            if (target.exists()) {
                target.delete()
            }
            if (!temp.renameTo(target)) {
                throw IllegalStateException("无法保存安装包")
            }
            return target
        } finally {
            if (temp.exists()) {
                temp.delete()
            }
        }
    }

    private data class DownloadMetadata(
        val contentLength: Long,
        val supportsRanges: Boolean,
    )

    private fun openDownloadConnection(url: String, method: String = "GET"): HttpURLConnection {
        return (URL(url).openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = true
            requestMethod = method
            connectTimeout = 15000
            readTimeout = 30000
            setRequestProperty("User-Agent", "CodexRemoteMobile")
        }
    }

    private fun fetchDownloadMetadata(url: String): DownloadMetadata {
        val connection = openDownloadConnection(url, "HEAD")
        return try {
            val status = connection.responseCode
            if (status !in 200..299) {
                DownloadMetadata(contentLength = -1, supportsRanges = false)
            } else {
                val acceptRanges = connection.getHeaderField("Accept-Ranges") ?: ""
                DownloadMetadata(
                    contentLength = connection.getHeaderFieldLong("Content-Length", -1),
                    supportsRanges = acceptRanges.contains("bytes", ignoreCase = true),
                )
            }
        } catch (_: Exception) {
            DownloadMetadata(contentLength = -1, supportsRanges = false)
        } finally {
            connection.disconnect()
        }
    }

    private fun downloadApkSingle(
        url: String,
        fileName: String,
        temp: File,
        expectedBytes: Long,
    ) {
        val connection = openDownloadConnection(url)
        try {
            val status = connection.responseCode
            if (status !in 200..299) {
                throw IllegalStateException("下载失败：HTTP $status")
            }
            val totalBytes = expectedBytes.takeIf { it > 0 }
                ?: connection.getHeaderFieldLong("Content-Length", -1)
            val reporter = DownloadProgressReporter(
                url = url,
                fileName = fileName,
                totalBytes = totalBytes,
                accelerated = false,
                connections = 1,
            )
            var downloadedBytes = 0L
            reporter.emit("downloading", downloadedBytes, force = true)
            BufferedInputStream(connection.inputStream).use { input ->
                temp.outputStream().use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) {
                            break
                        }
                        output.write(buffer, 0, read)
                        downloadedBytes += read.toLong()
                        reporter.emit("downloading", downloadedBytes)
                    }
                }
            }
            reporter.emit("completed", downloadedBytes, force = true)
        } finally {
            connection.disconnect()
        }
    }

    private fun downloadApkWithRanges(
        url: String,
        fileName: String,
        temp: File,
        totalBytes: Long,
    ): Boolean {
        val connections = min(
            maxDownloadConnections,
            ((totalBytes + acceleratedDownloadMinBytes - 1) / acceleratedDownloadMinBytes).toInt().coerceAtLeast(1),
        )
        if (connections <= 1) {
            return false
        }
        val downloadedBytes = AtomicLong(0)
        val reporter = DownloadProgressReporter(
            url = url,
            fileName = fileName,
            totalBytes = totalBytes,
            accelerated = true,
            connections = connections,
        )
        emitDownloadProgress(
            status = "preparing",
            url = url,
            fileName = fileName,
            downloadedBytes = 0,
            totalBytes = totalBytes,
            bytesPerSecond = 0,
            accelerated = true,
            connections = connections,
            message = "正在启用分段下载...",
        )
        var rangeWorkersStopped = true
        try {
            RandomAccessFile(temp, "rw").use { file ->
                file.setLength(totalBytes)
            }
            val pool = Executors.newFixedThreadPool(connections)
            val progressTicker = Executors.newSingleThreadScheduledExecutor()
            val ticker = progressTicker.scheduleAtFixedRate(
                {
                    reporter.emit("downloading", downloadedBytes.get(), force = true)
                },
                0,
                progressIntervalMs,
                TimeUnit.MILLISECONDS,
            )
            val futures = (0 until connections).map { index ->
                val start = totalBytes * index / connections
                val end = if (index == connections - 1) {
                    totalBytes - 1
                } else {
                    (totalBytes * (index + 1) / connections) - 1
                }
                pool.submit {
                    downloadRange(url, temp, start, end, downloadedBytes)
                }
            }
            try {
                futures.forEach { it.get() }
            } finally {
                futures.forEach { it.cancel(true) }
                ticker.cancel(true)
                progressTicker.shutdownNow()
                pool.shutdownNow()
                rangeWorkersStopped = pool.awaitTermination(10, TimeUnit.SECONDS)
            }
            if (downloadedBytes.get() != totalBytes) {
                throw IllegalStateException("分段下载未完成")
            }
            reporter.emit("completed", totalBytes, force = true)
            return true
        } catch (_: Exception) {
            if (temp.exists()) {
                temp.delete()
            }
            if (!rangeWorkersStopped) {
                throw IllegalStateException("分段下载停止超时")
            }
            emitDownloadProgress(
                status = "preparing",
                url = url,
                fileName = fileName,
                downloadedBytes = 0,
                totalBytes = totalBytes,
                bytesPerSecond = 0,
                accelerated = false,
                connections = 1,
                message = "分段下载不可用，切换普通下载...",
            )
            return false
        }
    }

    private fun downloadRange(
        url: String,
        temp: File,
        start: Long,
        end: Long,
        downloadedBytes: AtomicLong,
    ) {
        val connection = openDownloadConnection(url).apply {
            setRequestProperty("Range", "bytes=$start-$end")
        }
        try {
            val status = connection.responseCode
            if (status != HttpURLConnection.HTTP_PARTIAL) {
                throw IllegalStateException("服务器不支持分段下载：HTTP $status")
            }
            BufferedInputStream(connection.inputStream).use { input ->
                RandomAccessFile(temp, "rw").use { output ->
                    output.seek(start)
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) {
                            break
                        }
                        output.write(buffer, 0, read)
                        downloadedBytes.addAndGet(read.toLong())
                    }
                }
            }
        } finally {
            connection.disconnect()
        }
    }

    private inner class DownloadProgressReporter(
        private val url: String,
        private val fileName: String,
        private val totalBytes: Long,
        private val accelerated: Boolean,
        private val connections: Int,
    ) {
        private var lastEmitAt = 0L
        private var lastSpeedAt = System.currentTimeMillis()
        private var lastSpeedBytes = 0L

        @Synchronized
        fun emit(status: String, downloadedBytes: Long, force: Boolean = false) {
            val now = System.currentTimeMillis()
            if (!force && now - lastEmitAt < progressIntervalMs) {
                return
            }
            val elapsedMs = (now - lastSpeedAt).coerceAtLeast(1)
            val bytesPerSecond = (((downloadedBytes - lastSpeedBytes).coerceAtLeast(0)) * 1000L) / elapsedMs
            lastSpeedAt = now
            lastSpeedBytes = downloadedBytes
            lastEmitAt = now
            emitDownloadProgress(
                status = status,
                url = url,
                fileName = fileName,
                downloadedBytes = downloadedBytes,
                totalBytes = totalBytes,
                bytesPerSecond = bytesPerSecond,
                accelerated = accelerated,
                connections = connections,
            )
        }
    }

    private fun emitDownloadProgress(
        status: String,
        url: String,
        fileName: String,
        downloadedBytes: Long,
        totalBytes: Long,
        bytesPerSecond: Long,
        accelerated: Boolean,
        connections: Int,
        message: String? = null,
    ) {
        if (!::nativeChannel.isInitialized) {
            return
        }
        val progress = if (totalBytes > 0) {
            downloadedBytes.toDouble() / totalBytes.toDouble()
        } else {
            0.0
        }
        val payload = mapOf(
            "status" to status,
            "url" to url,
            "fileName" to fileName,
            "downloadedBytes" to downloadedBytes,
            "totalBytes" to totalBytes,
            "bytesPerSecond" to bytesPerSecond,
            "progress" to progress.coerceIn(0.0, 1.0),
            "accelerated" to accelerated,
            "connections" to connections,
            "message" to message,
        )
        runOnUiThread {
            nativeChannel.invokeMethod("downloadProgress", payload)
        }
    }

    private fun installApk(file: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
            val settingsIntent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:$packageName")
            ).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(settingsIntent)
            throw IllegalStateException("请允许此应用安装未知来源应用后，再点击下载安装。")
        }
        val apkUri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(apkUri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(intent)
    }

    @Deprecated("Deprecated in Android, but still supported by FlutterActivity for simple document picking.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != pickImageRequestCode) {
            return
        }
        val result = pendingPickResult ?: return
        pendingPickResult = null
        if (resultCode != Activity.RESULT_OK) {
            result.success(null)
            return
        }
        val uri = data?.data
        if (uri == null) {
            result.success(null)
            return
        }
        try {
            val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
            if (bytes == null || bytes.isEmpty()) {
                result.error("read_failed", "Selected image is empty", null)
                return
            }
            result.success(
                mapOf(
                    "name" to (displayName(uri) ?: "image"),
                    "mimeType" to (contentResolver.getType(uri) ?: "image/*"),
                    "bytes" to bytes,
                )
            )
        } catch (error: Exception) {
            result.error("read_failed", error.message, null)
        }
    }

    private val preferences
        get() = getSharedPreferences(preferencesName, Context.MODE_PRIVATE)

    private fun displayName(uri: Uri): String? {
        var cursor: Cursor? = null
        return try {
            cursor = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            if (cursor != null && cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0) cursor.getString(index) else null
            } else {
                null
            }
        } finally {
            cursor?.close()
        }
    }
}
