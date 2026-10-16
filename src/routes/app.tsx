import { createFileRoute } from '@tanstack/react-router'
import { HydrationUnit } from '../base/hydration/unit'
import { LarderApp } from '../ui/app'

export const Route = createFileRoute('/app')({
  // The records request starts with the document instead of after hydration (useLarder's first load reads it).
  head: () => ({ meta: [{ title: 'Larder' }], links: [{ rel: 'preload', href: '/api/larder/state', as: 'fetch', crossOrigin: 'anonymous' }] }),
  component: () => <HydrationUnit><LarderApp /></HydrationUnit>,
})
