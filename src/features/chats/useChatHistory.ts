import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { StoredTrip } from './contracts';
import { chatRepository } from './repository';
import { ChatHistoryController } from './chatHistoryController';

export function useChatHistory(userId: string | null, restore: (trip: StoredTrip, historical: boolean) => void | Promise<void>) {
  const restoreRef = useRef(restore); restoreRef.current = restore;
  const [controller] = useState(() => new ChatHistoryController(chatRepository, (trip, historical) => restoreRef.current(trip, historical)));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { void controller.start(userId); return () => controller.dispose(); }, [controller, userId]);
  return { state, controller };
}
