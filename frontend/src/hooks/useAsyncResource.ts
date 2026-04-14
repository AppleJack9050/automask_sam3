import { useEffect, useState } from 'react'

type AsyncResourceState<T> = {
  data: T | null
  error: string | null
  isLoading: boolean
  isRefreshing: boolean
  reload: () => Promise<void>
  setData: React.Dispatch<React.SetStateAction<T | null>>
}

export function useAsyncResource<T>(
  loader: () => Promise<T>,
  deps: React.DependencyList,
): AsyncResourceState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const runLoad = async (refresh: boolean) => {
    if (refresh) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }

    try {
      const nextValue = await loader()
      setData(nextValue)
      setError(null)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Request failed.')
    } finally {
      if (refresh) {
        setIsRefreshing(false)
      } else {
        setIsLoading(false)
      }
    }
  }

  useEffect(() => {
    let active = true

    setIsLoading(true)
    setError(null)

    loader()
      .then((nextValue) => {
        if (!active) {
          return
        }
        setData(nextValue)
        setError(null)
      })
      .catch((requestError) => {
        if (!active) {
          return
        }
        setError(requestError instanceof Error ? requestError.message : 'Request failed.')
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, deps)

  return {
    data,
    error,
    isLoading,
    isRefreshing,
    reload: () => runLoad(true),
    setData,
  }
}
