import { useProfiles } from '../state/profile';

export function ProfileAvatar({ identity, username, large = false }: { identity: string; username: string; large?: boolean }) {
  const image = useProfiles((s) => s.avatars[identity]);
  return <span className={`profile-avatar ${large ? 'large' : ''}`} aria-hidden="true">{image ? <img src={image} alt="" /> : username.trim().slice(0, 1).toLocaleUpperCase() || 'T'}</span>;
}
