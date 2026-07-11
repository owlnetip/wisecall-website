export type ConversionSignal = {
  lead: boolean | null | undefined;
  booking: boolean | null | undefined;
};

export function calculateConversionRate(signals: readonly ConversionSignal[]): number {
  if (signals.length === 0) return 0;
  const convertedCalls = signals.filter((signal) => signal.lead || signal.booking).length;
  return Math.round((convertedCalls / signals.length) * 100);
}
