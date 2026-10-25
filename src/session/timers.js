export function timerRemainingMs(timer, now = Date.now()) {
  if (!timer) return 0;
  return Math.max(0, timer.state === 'paused' ? timer.remainingMs : timer.endsAt - now);
}

export function validTimer(timer) {
  if (!timer || !Number.isFinite(timer.durationSeconds) || !['running', 'paused', 'elapsed', 'acknowledged', 'cancelled'].includes(timer.state)) return false;
  return timer.state === 'paused'
    ? timer.endsAt === null && Number.isFinite(timer.remainingMs) && timer.remainingMs > 0
    : Number.isFinite(timer.endsAt);
}
