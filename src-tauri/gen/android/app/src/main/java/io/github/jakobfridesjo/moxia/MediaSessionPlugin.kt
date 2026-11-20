package io.github.jakobfridesjo.moxia

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class WatchArgs {
  lateinit var onAction: Channel
}

@InvokeArg
class ShowArgs {
  var title: String? = null
  var artist: String? = null
  var playing: Boolean = false
}

/**
 * The radio's media session, which Rust's `media.rs` drives: what plays goes to the lock screen
 * and the notification, and their buttons, headset and Bluetooth buttons come back as actions.
 */
@TauriPlugin
class MediaSessionPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun watch(invoke: Invoke) {
    val args = invoke.parseArgs(WatchArgs::class.java)
    MediaPlaybackService.onAction = { action -> args.onAction.sendObject(action) }
    invoke.resolve()
  }

  @Command
  fun show(invoke: Invoke) {
    val args = invoke.parseArgs(ShowArgs::class.java)
    MediaPlaybackService.show(
      activity.applicationContext,
      MediaPlaybackService.Now(args.title, args.artist, args.playing),
    )
    invoke.resolve()
  }
}
