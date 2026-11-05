import { Badge } from '../ui/badge';

/** Valid, expired or revoked. */
export function CertificateStateBadge({ state }: { state: 'VALID' | 'EXPIRED' | 'REVOKED' }) {
  return state === 'VALID' ? <Badge variant="success">Valid</Badge> : state === 'EXPIRED' ? <Badge variant="warning">Expired</Badge> : <Badge variant="destructive">Revoked</Badge>;
}
