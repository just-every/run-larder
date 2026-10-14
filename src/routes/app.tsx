import { createFileRoute } from '@tanstack/react-router'
import { HydrationUnit } from '../base/hydration/unit'
import { LarderApp } from '../ui/app'

export const Route = createFileRoute('/app')({
  head: () => ({ meta: [{ title: 'Larder' }] }),
  component: () => <HydrationUnit><LarderApp /></HydrationUnit>,
})
