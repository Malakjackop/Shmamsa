import { platformBrowser } from '@angular/platform-browser';
import { AppModule } from './app/app-module';
import { registerLocaleData } from '@angular/common';
import localeAr from '@angular/common/locales/ar';
import localeArEg from '@angular/common/locales/ar-EG';

registerLocaleData(localeAr);
registerLocaleData(localeArEg);
platformBrowser().bootstrapModule(AppModule, {
  ngZoneEventCoalescing: true,
  
})
  .catch(err => console.error(err));
