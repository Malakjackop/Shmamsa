package com.shmamsa.model;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "families")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class FamilyCatalog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 50)
    private String code;

    @Column(name = "name_ar", nullable = false, unique = true, length = 100)
    private String nameAr;

    @Column(name = "base_name", length = 100)
    private String baseName;

    @Column(length = 10)
    private String branch;

    @Column(nullable = false, length = 20)
    private String category;

    @Column(nullable = false)
    private Boolean active;

    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder;

    @Column(name = "servant_selectable", nullable = false)
    private Boolean servantSelectable;

    @Column(name = "member_selectable", nullable = false)
    private Boolean memberSelectable;
}
