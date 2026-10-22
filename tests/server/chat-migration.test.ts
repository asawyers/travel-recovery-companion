import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrations = new URL('../../supabase/migrations/', import.meta.url)
const filename = readdirSync(migrations).find(name => name.endsWith('_persist_recovery_conversations.sql'))
if (!filename) throw new Error('Chat persistence migration is missing')
const sql = readFileSync(new URL(filename, migrations), 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase()
const owner = /\(select auth\.uid\(\)\) = user_id/

function policy(operation: string) {
  return sql.match(new RegExp(`create policy [^;]+ for ${operation} [^;]+;`))?.[0] ?? ''
}

describe('account chat migration security contract', () => {
  it('makes every conversation belong to a real account with cascading account deletion', () => {
    expect(sql).toMatch(/create table public\.recovery_conversations \(/)
    expect(sql).toMatch(/id uuid primary key default gen_random_uuid\(\)/)
    expect(sql).toMatch(/user_id uuid not null default auth\.uid\(\) references auth\.users\(id\) on delete cascade/)
    expect(sql).toMatch(/on public\.recovery_conversations \(user_id, updated_at desc, id\)/)
  })

  it('bounds plaintext history and trip input snapshots', () => {
    expect(sql).toMatch(/char_length\(title\) between 1 and 120/)
    expect(sql).toMatch(/messages jsonb not null default '\[\]'::jsonb/)
    expect(sql).toMatch(/jsonb_typeof\(messages\) = 'array'/)
    expect(sql).toMatch(/jsonb_array_length\(messages\) <= 1000/)
    expect(sql).toMatch(/octet_length\(messages::text\) <= 1100000/)
    expect(sql).toMatch(/jsonb_typeof\(trip\) = 'object'/)
    expect(sql).toMatch(/octet_length\(trip::text\) <= 16384/)
    expect(sql).toContain("message - array['id', 'role', 'content', 'revision']")
    expect(sql).toContain("char_length(message ->> 'content') > 1000")
  })

  it('requires owner authorization for every CRUD action and blocks owner reassignment', () => {
    expect(sql).toContain('alter table public.recovery_conversations enable row level security;')
    for (const operation of ['select', 'insert', 'update', 'delete']) {
      expect(policy(operation)).toContain('to authenticated')
      expect(policy(operation)).toMatch(owner)
    }
    expect(policy('select')).toContain('using (')
    expect(policy('delete')).toContain('using (')
    expect(policy('insert')).toContain('with check (')
    expect(policy('update')).toMatch(/using \([^;]+with check \(/)
    expect(policy('update').match(/\(select auth\.uid\(\)\) = user_id/g)).toHaveLength(2)
  })

  it('grants only authenticated CRUD and adds no privileged callable code', () => {
    expect(sql).toContain('revoke all on table public.recovery_conversations from public, anon, authenticated;')
    expect(sql).toContain('grant select, insert, update, delete on table public.recovery_conversations to authenticated;')
    expect(sql).not.toContain('security definer')
    expect(sql).toContain('security invoker')
    expect(sql).toContain("set search_path = ''")
    expect(sql).toContain('revoke all on function public.guard_recovery_conversation() from public, anon, authenticated;')
  })

  it('sets timestamps with the database clock and requires each update to advance one revision', () => {
    expect(sql).toMatch(/revision integer not null default 0 check \(revision >= 0\)/)
    expect(sql).toContain('new.revision <> old.revision + 1')
    expect(sql).toContain('new.user_id is distinct from old.user_id')
    expect(sql).toContain('new.created_at := old.created_at;')
    expect(sql).toContain('new.updated_at := clock_timestamp();')
    expect(sql).toMatch(/before insert or update on public\.recovery_conversations for each row execute function public\.guard_recovery_conversation\(\)/)
  })
})
