package com.shmamsa.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Getter
@Setter
@Table(name = "choir_standings")
public class ChoirStanding {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false, length = 60)
    private String khors;

    private int rows;
    private int cols;

    @Column(length = 20)
    private String direction;

    @Column(name = "seats_json", columnDefinition = "TEXT")
    private String seatsJson;

    private boolean published;
    private boolean frontAtTop = true;
    private int frontOffset;
    private int crowdOffset;

    private LocalDateTime updatedAt;

    @PrePersist
    @PreUpdate
    public void onSave() {
        updatedAt = LocalDateTime.now();
    }
}
