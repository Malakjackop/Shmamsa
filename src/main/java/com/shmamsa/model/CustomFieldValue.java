package com.shmamsa.model;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "custom_field_values",
       uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "field_key"}))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CustomFieldValue {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "field_key", nullable = false, length = 100)
    private String fieldKey;

    @Column(name = "field_value", length = 2000)
    private String value;
}
