type IconName =
  | 'search'
  | 'arrow'
  | 'book'
  | 'grid'
  | 'list'
  | 'close'
  | 'check'
  | 'share'
  | 'info'
  | 'sliders'
  | 'star'
  | 'thumb-up'
  | 'thumb-down'
  | 'message';
const paths: Record<IconName, string> = {
  search: 'm21 21-4.5-4.5 M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  book: 'M12 5v16M3 4h4a5 5 0 0 1 5 3 5 5 0 0 1 5-3h4v15h-4a5 5 0 0 0-5 2 5 5 0 0 0-5-2H3z',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  list: 'M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01',
  close: 'm6 6 12 12M6 18 18 6',
  check: 'm5 12 4 4L19 6',
  share: 'M12 16V3m-4 4 4-4 4 4M5 12v8h14v-8',
  info: 'M12 11v6m0-10h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  sliders: 'M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z',
  'thumb-up': 'M7 10v11H3V10zm0 0 6-8v8h7l1 2-2 9H7',
  'thumb-down': 'M7 14V3H3v11zm0 0 6 8v-8h7l1-2-2-9H7',
  message: 'M21 15a3 3 0 0 1-3 3H8l-5 3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z',
};
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
