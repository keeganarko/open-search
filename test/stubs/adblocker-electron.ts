/** No network filter engine is needed by the pure session-policy unit tests. */
export class ElectronBlocker {
  static async fromPrebuiltAdsAndTracking(): Promise<ElectronBlocker> {
    return new ElectronBlocker()
  }

  on(): void {}
  enableBlockingInSession(): void {}
  disableBlockingInSession(): void {}
}
