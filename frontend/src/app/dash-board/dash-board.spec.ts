import { NO_ERRORS_SCHEMA, PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { DashBoard } from './dash-board';
import { AuthService } from '../services/auth.service';
import { AttendanceService } from '../services/attendance.service';
import { FamilyService } from '../services/family.service';
import { BoardService } from '../services/board.service';

describe('DashBoard', () => {
  let component: DashBoard;
  let fixture: ComponentFixture<DashBoard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FormsModule, ReactiveFormsModule],
      declarations: [DashBoard],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        {
          provide: AuthService,
          useValue: {
            getUserData: () => of({ role: 'USER' }),
            getMyQrToken: () => of({ token: '' })
          }
        },
        {
          provide: AttendanceService,
          useValue: {
            getMyStats: () => of({})
          }
        },
        {
          provide: FamilyService,
          useValue: {
            families: () => of([])
          }
        },
        {
          provide: BoardService,
          useValue: {
            listEvents: () => of([]),
            createEvent: () => of({}),
            updateEvent: () => of({}),
            publishEvent: () => of({}),
            unpublishEvent: () => of({}),
            deleteEvent: () => of({}),
            joinEvent: () => of({}),
            unjoinEvent: () => of({}),
            participants: () => of([])
          }
        }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(DashBoard);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
