package br.com.pitacco.entregador;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import com.google.android.gms.location.ActivityTransitionEvent;
import com.google.android.gms.location.ActivityTransitionResult;

/**
 * Receives Play services activity transitions only for a running courier
 * foreground-service shift. No motion history or activity data leaves device.
 *
 * Non-exported explicit receiver: a foreign app cannot inject a transition.
 */
public final class CourierMotionReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null || !CourierLocationService.isRunning()
                || !ActivityTransitionResult.hasResult(intent)) return;
        ActivityTransitionResult result = ActivityTransitionResult.extractResult(intent);
        if (result == null) return;
        for (ActivityTransitionEvent event : result.getTransitionEvents()) {
            CourierLocationService.onMotionTransition(
                    event.getActivityType(),
                    event.getTransitionType(),
                    event.getElapsedRealTimeNanos());
        }
    }
}
