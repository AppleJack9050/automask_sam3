type LoadingPanelProps = {
  title: string
  description: string
}

export function LoadingPanel({ title, description }: LoadingPanelProps) {
  return (
    <div className="panel loading-panel">
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  )
}
