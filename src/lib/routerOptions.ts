/**
 * How the app's router renders a change of address: at once, not in one of React's transitions. Search's
 * query and year fields take their value from the address, and in a transition the new address renders a
 * moment after the key, so React puts the field's older text back meanwhile: the caret jumps to the end,
 * and a key typed in that moment is lost (#386). Nothing in the app suspends, so a transition has nothing
 * to hold back. Every router in the tests (`renderWithRouter` and those a test builds itself) takes the
 * same options, so the tests render as the app does.
 */
export const ROUTER_OPTIONS = { useTransitions: false } as const
