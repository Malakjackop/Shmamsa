import { Component, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { ZXingScannerModule } from '@zxing/ngx-scanner';

@Component({
  selector: 'app-attendance-scanner-popup',
  standalone: true,
  imports: [CommonModule, ZXingScannerModule],
  templateUrl: './attendance-scanner-popup.html',
  styleUrls: ['./attendance-scanner-popup.css']
})
export class AttendanceScannerPopupComponent {
  isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  onCodeResult(resultString: string): void {
    if (!this.isBrowser) return;
    try {
      if (window.opener) {
        window.opener.postMessage({ type: 'qr-result', data: resultString }, '*');
      }
    } catch {}
    try { window.close(); } catch {}
  }

  close(): void {
    if (!this.isBrowser) return;
    try { window.close(); } catch {}
  }
}
