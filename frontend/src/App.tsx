import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import './App.css'
import { DatasetPage } from './pages/DatasetPage'
import { EditorPage } from './pages/EditorPage'
import { UploadPage } from './pages/UploadPage'

function AppShell() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">AutoMask</p>
          <h1 className="app-title">Research-grade image segmentation workspace</h1>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<UploadPage />} />
          <Route path="/datasets/:datasetId" element={<DatasetPage />} />
          <Route path="/datasets/:datasetId/images/:imageId" element={<EditorPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  )
}
