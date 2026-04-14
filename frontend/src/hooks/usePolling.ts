import { useEffect, useEffectEvent } from 'react'

export function usePolling(
  enabled: boolean,
  intervalMs: number,
  callback: () => void | Promise<void>,
) {
  const onTick = useEffectEvent(callback)

  useEffect(() => {
    if (!enabled) {
      return
    }

    const timer = window.setInterval(() => {
      void onTick()
    }, intervalMs)

    return () => window.clearInterval(timer)
  }, [enabled, intervalMs, onTick])
}
