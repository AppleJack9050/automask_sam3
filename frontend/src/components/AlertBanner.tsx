type AlertBannerProps = {
  kind?: 'error' | 'info' | 'success'
  message: string
}

export function AlertBanner({ kind = 'info', message }: AlertBannerProps) {
  return <p className={`alert-banner alert-${kind}`}>{message}</p>
}
