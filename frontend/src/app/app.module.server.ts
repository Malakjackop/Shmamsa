import { NgModule } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { App } from './app';
import { AppModule } from './app-module';
import { serverRoutes } from './app.routes.server';
import { registerLocaleData } from '@angular/common';
import localeAr from '@angular/common/locales/ar';
import localeArEg from '@angular/common/locales/ar-EG';

registerLocaleData(localeAr);
registerLocaleData(localeArEg);

@NgModule({
  imports: [AppModule],
  providers: [provideServerRendering(withRoutes(serverRoutes))],
  bootstrap: [App],
})
export class AppServerModule {}
