package com.example.codex_remote_mobile

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
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
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class MainActivity : FlutterActivity() {
    private val channelName = "codex_remote_mobile/native"
    private val preferencesName = "codex_remote_mobile"
    private val pickImageRequestCode = 42017
    private val downloadExecutor = Executors.newSingleThreadExecutor()
    private var pendingPickResult: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName).setMethodCallHandler { call, result ->
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
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = true
            connectTimeout = 15000
            readTimeout = 30000
            setRequestProperty("User-Agent", "CodexRemoteMobile")
        }
        try {
            val status = connection.responseCode
            if (status !in 200..299) {
                throw IllegalStateException("下载失败：HTTP $status")
            }
            connection.inputStream.use { input ->
                temp.outputStream().use { output ->
                    input.copyTo(output)
                }
            }
            if (target.exists()) {
                target.delete()
            }
            if (!temp.renameTo(target)) {
                throw IllegalStateException("无法保存安装包")
            }
            return target
        } finally {
            connection.disconnect()
            if (temp.exists()) {
                temp.delete()
            }
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
