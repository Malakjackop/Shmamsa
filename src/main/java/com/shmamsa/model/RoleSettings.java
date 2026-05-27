package com.shmamsa.model;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "role_settings")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RoleSettings {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false, length = 50)
    private String name;

    @Column(name = "display_name_ar", length = 100)
    private String displayNameAr;

    @Column(name = "sort_order")
    private int sortOrder;

    private boolean active = true;

    @Column(length = 2000)
    private String permissions;
}
