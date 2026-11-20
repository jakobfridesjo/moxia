package io.github.jakobfridesjo.moxia

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.media.app.NotificationCompat.MediaStyle
import androidx.media.session.MediaButtonReceiver

/**
 * Keeps the radio playing with the screen off: a media playback service in the foreground while
 * something plays, holding the CPU and Wi-Fi awake, with a media session for the lock screen, the
 * notification and media buttons. When the radio stops, the notification stays with a play
 * button until it is swiped away; when the radio shows nothing, the service goes.
 */
class MediaPlaybackService : Service() {
  data class Now(val title: String?, val artist: String?, val playing: Boolean)

  companion object {
    private const val CHANNEL = "playback"
    private const val NOTIFICATION = 1
    private const val ACTIONS =
      PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or
        PlaybackStateCompat.ACTION_PLAY_PAUSE or PlaybackStateCompat.ACTION_STOP or
        PlaybackStateCompat.ACTION_SKIP_TO_NEXT or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS

    /** Where the session's buttons go: the frontend, through Rust's channel. */
    @Volatile var onAction: ((String) -> Unit)? = null

    private val main = Handler(Looper.getMainLooper())
    private var now = Now(null, null, false)
    private var running: MediaPlaybackService? = null

    /** Shows `next`, starting the service once something plays. */
    fun show(context: Context, next: Now) =
      main.post {
        now = next
        val service = running
        when {
          service != null -> service.refresh()
          next.title != null && next.playing ->
            try {
              ContextCompat.startForegroundService(
                context,
                Intent(context, MediaPlaybackService::class.java),
              )
            } catch (error: IllegalStateException) {
              // Android refuses a foreground service started from the background.
              android.util.Log.w("Moxia", "Could not start playing in the background", error)
            }
        }
      }
  }

  private lateinit var session: MediaSessionCompat
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null

  override fun onCreate() {
    super.onCreate()
    running = this
    session =
      MediaSessionCompat(this, "Moxia").apply {
        setCallback(
          object : MediaSessionCompat.Callback() {
            override fun onPlay() = act("play")

            override fun onPause() = act("pause")

            override fun onStop() = act("stop")

            override fun onSkipToNext() = act("next")

            override fun onSkipToPrevious() = act("previous")
          }
        )
        setSessionActivity(openApp())
        isActive = true
      }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel =
        NotificationChannel(
            CHANNEL,
            getString(R.string.playback_channel),
            NotificationManager.IMPORTANCE_LOW,
          )
          .apply { description = getString(R.string.playback_channel_description) }
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    MediaButtonReceiver.handleIntent(session, intent)
    // A service started in the foreground must say so at once, even should it stop straight after.
    goForeground(notification())
    refresh()
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    running = null
    holdAwake(false)
    session.release()
    super.onDestroy()
  }

  private fun act(action: String) {
    onAction?.invoke(action)
  }

  /** Shows `now`: in the foreground while it plays, else a notification to play it again. */
  fun refresh() {
    if (now.title == null) {
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
      stopSelf()
      return
    }
    session.setMetadata(
      MediaMetadataCompat.Builder()
        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, now.title)
        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, now.artist)
        .build()
    )
    val state = if (now.playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
    session.setPlaybackState(
      PlaybackStateCompat.Builder()
        .setActions(ACTIONS)
        .setState(state, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 1f)
        .build()
    )
    val notification = notification()
    holdAwake(now.playing)
    if (now.playing) {
      goForeground(notification)
    } else {
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH)
      getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification)
    }
  }

  private fun goForeground(notification: Notification) {
    val type =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
      else 0
    ServiceCompat.startForeground(this, NOTIFICATION, notification, type)
  }

  private fun notification(): Notification {
    fun button(icon: Int, title: Int, action: Long) =
      NotificationCompat.Action(
        icon,
        getString(title),
        MediaButtonReceiver.buildMediaButtonPendingIntent(this, action),
      )
    val toggle =
      if (now.playing) button(android.R.drawable.ic_media_pause, R.string.action_stop, PlaybackStateCompat.ACTION_PAUSE)
      else button(android.R.drawable.ic_media_play, R.string.action_play, PlaybackStateCompat.ACTION_PLAY)
    return NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(R.drawable.ic_launcher_foreground)
      .setContentTitle(now.title)
      .setContentText(now.artist)
      .setContentIntent(openApp())
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(true)
      .setOngoing(now.playing)
      .addAction(button(android.R.drawable.ic_media_previous, R.string.action_previous, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS))
      .addAction(toggle)
      .addAction(button(android.R.drawable.ic_media_next, R.string.action_next, PlaybackStateCompat.ACTION_SKIP_TO_NEXT))
      .setStyle(MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0, 1, 2))
      .build()
  }

  private fun openApp(): PendingIntent =
    PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  /** Keeps the CPU, for decoding, and Wi-Fi, for the stream, awake while the radio plays. */
  @SuppressLint("WakelockTimeout")
  private fun holdAwake(awake: Boolean) {
    if (awake) {
      val wake =
        wakeLock
          ?: getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "moxia:playback")
            .also { wakeLock = it }
      if (!wake.isHeld) wake.acquire()
      @Suppress("DEPRECATION")
      val wifi =
        wifiLock
          ?: (applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager)
            .createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "moxia:playback")
            .also { wifiLock = it }
      if (!wifi.isHeld) wifi.acquire()
    } else {
      wakeLock?.takeIf { it.isHeld }?.release()
      wifiLock?.takeIf { it.isHeld }?.release()
    }
  }
}
