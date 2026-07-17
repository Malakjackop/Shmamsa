package com.shmamsa.repository;

import com.shmamsa.model.ChoirStanding;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface ChoirStandingRepository extends JpaRepository<ChoirStanding, Long> {
    Optional<ChoirStanding> findByKhors(String khors);
}
