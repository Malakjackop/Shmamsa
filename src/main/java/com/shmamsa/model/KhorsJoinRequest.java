package com.shmamsa.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "khors_join_requests")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class KhorsJoinRequest {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false, fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    /** MARMARKOS / ATHANASIUS */
    @Column(name = "requested_khors", nullable = false, length = 30)
    private String requestedKhors;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private KhorsJoinRequestStatus status;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    private LocalDateTime decidedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "decided_by")
    private User decidedBy;
}
