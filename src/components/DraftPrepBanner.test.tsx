import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DraftPrepBanner } from './DraftPrepBanner';

describe('DraftPrepBanner', () => {
  it('names both seasons and fires the jump', () => {
    const onOpen = vi.fn().mockResolvedValue(undefined);
    render(<DraftPrepBanner draftSeason={2026} leagueSeason={2025} onOpen={onOpen} />);

    expect(screen.getByText('2026 draft prep')).toBeInTheDocument();
    expect(screen.getByText(/viewing the 2025 season/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Open 2026 Draft Room/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('disables the button while the jump is in flight', async () => {
    let release: () => void = () => {};
    const onOpen = vi.fn().mockImplementation(
      () => new Promise<void>(resolve => { release = resolve; }),
    );
    render(<DraftPrepBanner draftSeason={2026} leagueSeason={2025} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole('button', { name: /Open 2026 Draft Room/ }));
    const busy = await screen.findByRole('button', { name: /Loading 2026/ });
    expect(busy).toBeDisabled();

    release();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Open 2026 Draft Room/ })).toBeEnabled(),
    );
  });
});
