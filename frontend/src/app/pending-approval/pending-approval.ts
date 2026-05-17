import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-pending-approval',
  standalone: false,
  templateUrl: './pending-approval.html',
  styleUrls: ['./pending-approval.css']
})
export class PendingApprovalComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private auth = inject(AuthService);
  private router = inject(Router);
  familyName = '';

  ngOnInit() {
    this.route.queryParams.subscribe(p => this.familyName = p['family'] || '');
  }

  logout() {
    this.auth.logout().subscribe(() => this.router.navigate(['/login']));
  }
}
