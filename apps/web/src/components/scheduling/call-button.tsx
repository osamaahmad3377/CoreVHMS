'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Megaphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { api } from '@/lib/api';

const ROOM_KEY = 'vcms.callRoom';
const readRoom = () => {
  try {
    return localStorage.getItem(ROOM_KEY) ?? '';
  } catch {
    return '';
  }
};

/** The waiting-room token, e.g. "#12", as a small badge. */
export function TokenBadge({ token, className }: { token?: number | null; className?: string }) {
  if (!token) return null;
  return (
    <span className={`inline-flex h-7 min-w-9 items-center justify-center rounded-lg bg-foreground px-2 text-sm font-bold tabular text-background ${className ?? ''}`} title={`Token ${token}`}>
      #{token}
    </span>
  );
}

/**
 * Calls a waiting patient to a room: the waiting-room TV shows and announces "Token 12 → Room 2". The room used
 * last on this computer is remembered, so most calls are one tap; the arrow picks another room.
 */
export function CallButton({ appointmentId, branchId, calledRoom, callCount, size = 'sm' }: { appointmentId: string; branchId: string; calledRoom?: string | null; callCount?: number; size?: 'sm' | 'default' }) {
  const qc = useQueryClient();
  const [room, setRoom] = useState('');
  useEffect(() => setRoom(readRoom()), []);
  const rooms = useQuery({ queryKey: ['call-rooms', branchId], queryFn: () => api.get<string[]>(`/waiting-room/rooms?branchId=${branchId}`), staleTime: 300_000 });
  const call = useMutation({
    mutationFn: (r: string) => api.post<{ tokenNumber: number | null }>(`/appointments/${appointmentId}/call`, { room: r }),
    onSuccess: (a, r) => {
      try {
        localStorage.setItem(ROOM_KEY, r);
      } catch {
        /* storage unavailable */
      }
      setRoom(r);
      toast.success(`Called${a.tokenNumber ? ` token ${a.tokenNumber}` : ''}${r ? ` to ${r}` : ''} — shown on the waiting-room screen`);
      qc.invalidateQueries({ queryKey: ['queue'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const again = !!callCount;
  return (
    <div className="inline-flex">
      <Button size={size} variant="outline" className="rounded-r-none border-r-0" loading={call.isPending} onClick={() => call.mutate(room)} title={room ? `Call to ${room}` : 'Call (choose a room with the arrow)'}>
        <Megaphone /> {again ? 'Call again' : 'Call'}
        {room && <span className="text-muted-foreground">· {room}</span>}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size={size === 'sm' ? 'icon-sm' : 'icon'} variant="outline" className="h-auto rounded-l-none" aria-label="Choose the room">
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Call to</DropdownMenuLabel>
          {(rooms.data ?? []).map((r) => (
            <DropdownMenuItem key={r} onSelect={() => call.mutate(r)}>
              {r}
              {r === (calledRoom ?? room) && <span className="ml-auto text-xs text-muted-foreground">last</span>}
            </DropdownMenuItem>
          ))}
          {!rooms.data?.length && <p className="px-3 py-2 text-xs text-muted-foreground">No rooms yet — add them under Settings → Rooms & equipment.</p>}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => call.mutate('')}>Just call (no room)</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
