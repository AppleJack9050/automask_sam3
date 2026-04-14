import '@testing-library/jest-dom/vitest'

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  value: () => ({
    clearRect: () => undefined,
    drawImage: () => undefined,
    getImageData: () => ({
      data: new Uint8ClampedArray(),
    }),
    putImageData: () => undefined,
  }),
})

Object.defineProperty(window.Image.prototype, 'decode', {
  value: () => Promise.resolve(),
})
