// Shared sentinel for "Exit setup" choices in any setup submenu.
//
// Each submenu's outer select adds an `Exit setup` option alongside
// `Back to setup`. When the user picks it, the walk returns this
// sentinel and the hub exits cleanly with the same "Saved to ..."
// message it would print when "Exit setup" is picked from the hub
// itself. This way the user can quit from anywhere in the wizard
// without first navigating back up.

export const EXIT_SETUP = '__exit_setup__' as const;
export type ExitSentinel = typeof EXIT_SETUP;

/** Common option entry. Reused so every submenu's exit row reads the
 *  same and uses the same value the hub knows to catch. */
export const EXIT_SETUP_OPTION = {
  value: EXIT_SETUP,
  label: 'Exit setup',
} as const;
