import type { SelectionStorage } from '../features/recovery/savedSelection'

let currentUserId: string | null = null

/** This scope is updated before the authenticated planner mounts. */
export function setPlanStorageUser(userId: string | null): void {
  currentUserId = userId?.trim() || null
}

export function accountStorage(storage: SelectionStorage, userId: string): SelectionStorage {
  if (!userId.trim()) throw new Error('Sign in before accessing saved plans.')
  const scoped = (key: string) => `${key}:account:${encodeURIComponent(userId)}`
  return {
    getItem: key => storage.getItem(scoped(key)),
    setItem: (key, value) => storage.setItem(scoped(key), value),
    removeItem: key => storage.removeItem(scoped(key)),
  }
}

/** Old account-free snapshots remain untouched and are not assigned to a new account. */
export function currentAccountStorage(storage: SelectionStorage): SelectionStorage {
  if (!currentUserId) throw new Error('Sign in before accessing saved plans.')
  return accountStorage(storage, currentUserId)
}
