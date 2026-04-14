type ActionBarProps = {
  title: string
  description: string
  aside?: React.ReactNode
  actions?: React.ReactNode
}

export function ActionBar({ title, description, aside, actions }: ActionBarProps) {
  return (
    <div className="action-bar">
      <div className="action-bar-copy">
        <p className="eyebrow">Next step</p>
        <h2>{title}</h2>
        <p className="helper-text">{description}</p>
      </div>
      {aside ? <div className="action-bar-aside">{aside}</div> : null}
      {actions ? <div className="action-bar-actions">{actions}</div> : null}
    </div>
  )
}
