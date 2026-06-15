import { describe, it, expect, beforeEach } from 'vitest';
import { useInboxViewStore } from '@/stores/inboxViewStore';

// W7 — Work Inbox "last-used view" persistence. This UI state is deliberately
// separate from Plan A's notification *delivery* preferences; it lives in
// localStorage so a user's filter/grouping/sort survives a reload.
const STORAGE_KEY = 'inbox-view';

function reset() {
  localStorage.clear();
  useInboxViewStore.setState({
    status: 'open',
    activeCategory: null,
    unreadOnly: false,
    groupBy: 'date',
    sort: 'newest',
  });
}

describe('inboxViewStore', () => {
  beforeEach(reset);

  it('defaults to the open, date-grouped, newest-first view', () => {
    const s = useInboxViewStore.getState();
    expect(s.status).toBe('open');
    expect(s.activeCategory).toBeNull();
    expect(s.unreadOnly).toBe(false);
    expect(s.groupBy).toBe('date');
    expect(s.sort).toBe('newest');
  });

  it('setView patches only the supplied fields', () => {
    useInboxViewStore.getState().setView({ status: 'snoozed', sort: 'oldest' });
    const s = useInboxViewStore.getState();
    expect(s.status).toBe('snoozed');
    expect(s.sort).toBe('oldest');
    // Untouched fields keep their value.
    expect(s.groupBy).toBe('date');
    expect(s.activeCategory).toBeNull();
  });

  it('persists the view shape to localStorage (without the setter)', () => {
    useInboxViewStore.getState().setView({
      status: 'done',
      activeCategory: 'review',
      unreadOnly: true,
      groupBy: 'category',
      sort: 'oldest',
    });

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw as string).state;
    expect(persisted).toMatchObject({
      status: 'done',
      activeCategory: 'review',
      unreadOnly: true,
      groupBy: 'category',
      sort: 'oldest',
    });
    // The action must never be serialized.
    expect('setView' in persisted).toBe(false);
  });

  it('rehydrates the persisted view into a fresh store instance', async () => {
    // Seed localStorage as if a previous session had saved a custom view.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { status: 'snoozed', activeCategory: 'mention', unreadOnly: false, groupBy: 'entity', sort: 'oldest' },
        version: 0,
      })
    );
    await useInboxViewStore.persist.rehydrate();

    const s = useInboxViewStore.getState();
    expect(s.status).toBe('snoozed');
    expect(s.activeCategory).toBe('mention');
    expect(s.groupBy).toBe('entity');
    expect(s.sort).toBe('oldest');
  });
});
