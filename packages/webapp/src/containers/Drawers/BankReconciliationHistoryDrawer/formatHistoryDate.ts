import moment from 'moment';

/** Date shown in the history drawer, `—` when there is none. */
export const formatHistoryDate = (date?: string | null): string =>
  date ? moment(date).format('YYYY MMM DD') : '—';
