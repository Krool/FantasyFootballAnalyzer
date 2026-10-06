import { describe, expect, it } from 'vitest';
import { blockerSafeName } from './chunkNames';

describe('blockerSafeName', () => {
  // assets/consensus-<hash>.js was blocked by Safari content blockers.
  it.each(['consensus', 'consensusGrade', 'cookieBanner', 'analytics', 'adTracker', 'ads', 'my-ad'])(
    'renames %s',
    name => expect(blockerSafeName(name)).toBe('chunk'),
  );

  it.each(['DraftPage', 'TeamsPage', 'draftPool', 'useDraftRoom', 'loads', 'readme', 'index', 'awards'])(
    'keeps %s',
    name => expect(blockerSafeName(name)).toBe(name),
  );
});
