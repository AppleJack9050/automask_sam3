import { Link } from 'react-router-dom'

import { StatusBadge } from '../../components/StatusBadge'
import type { Dataset, EditorState } from '../../types'

type EditorSidebarProps = {
  dataset: Dataset
  editor: EditorState
}

export function EditorSidebar({ dataset, editor }: EditorSidebarProps) {
  return (
    <aside className="sidebar panel">
      <div className="section-heading">
        <h2>Dataset browser</h2>
        <span>{dataset.images.length} images</span>
      </div>
      <div className="sidebar-links">
        <Link className="secondary-button" to={`/datasets/${dataset.id}`}>
          Back to dataset
        </Link>
        <a className="link-button" href={editor.historyUrl}>
          Download history JSON
        </a>
      </div>
      <ul className="image-nav-list">
        {dataset.images.map((image, index) => (
          <li key={image.id} className={image.id === editor.id ? 'active' : ''}>
            <Link to={`/datasets/${dataset.id}/images/${image.id}`}>
              <strong>{index + 1}. {image.relativePath}</strong>
              <span className="sidebar-status">
                <StatusBadge state={image.processingState} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  )
}
