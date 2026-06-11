import { Link } from 'react-router-dom';
import styles from './TeamLink.module.css';

interface TeamLinkProps {
  teamId: string;
  name: string;
  className?: string;
}

// Every fantasy team name in the app links to that team's hub page.
export function TeamLink({ teamId, name, className }: TeamLinkProps) {
  return (
    <Link
      to={`/teams?team=${encodeURIComponent(teamId)}`}
      className={`${styles.link} ${className ?? ''}`}
      title={`Open ${name}'s team page`}
      onClick={e => e.stopPropagation()}
    >
      {name}
    </Link>
  );
}
