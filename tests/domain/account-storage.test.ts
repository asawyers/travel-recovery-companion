import { afterEach, expect, it } from 'vitest'
import { accountStorage, currentAccountStorage, setPlanStorageUser } from '../../src/lib/account-storage'
const key = 'travel-recovery:selected:v1'
function memory() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } } }
afterEach(() => setPlanStorageUser(null))
it('isolates saved plans between accounts without deleting old unclaimed records', () => {
 const raw = memory(); raw.setItem(key, 'old guest snapshot')
 const a = accountStorage(raw, 'account-a'), b = accountStorage(raw, 'account-b')
 a.setItem(key, 'A plan'); b.setItem(key, 'B plan')
 expect(a.getItem(key)).toBe('A plan'); expect(b.getItem(key)).toBe('B plan')
 a.removeItem(key); expect(a.getItem(key)).toBeNull(); expect(b.getItem(key)).toBe('B plan')
 expect(raw.getItem(key)).toBe('old guest snapshot')
})
it('makes current-account storage unavailable after signout and restores only the signed-in account', () => {
 const raw = memory(); setPlanStorageUser('account-a'); currentAccountStorage(raw).setItem(key, 'A plan')
 setPlanStorageUser(null); expect(() => currentAccountStorage(raw)).toThrow(/sign in/i)
 setPlanStorageUser('account-b'); expect(currentAccountStorage(raw).getItem(key)).toBeNull()
 setPlanStorageUser('account-a'); expect(currentAccountStorage(raw).getItem(key)).toBe('A plan')
})
it('rejects missing account IDs instead of falling back to shared storage', () => {
 expect(() => accountStorage(memory(), '')).toThrow(); expect(() => accountStorage(memory(), '   ')).toThrow()
})
