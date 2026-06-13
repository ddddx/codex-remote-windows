package com.example.codex_remote_mobile

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val channelName = "codex_remote_mobile/native"
    private val preferencesName = "codex_remote_mobile"
    private val pickImageRequestCode = 42017
    private var pendingPickResult: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName).setMethodCallHandler { call, result ->
            when (call.method) {
                "getString" -> getStringValue(call, result)
                "setString" -> setStringValue(call, result)
                "remove" -> removeValue(call, result)
                "pickImage" -> pickImage(result)
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
