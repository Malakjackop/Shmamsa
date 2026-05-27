package com.shmamsa.repository;

import com.shmamsa.model.RoleSettings;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface RoleSettingsRepository extends JpaRepository<RoleSettings, Long> {
    Optional<RoleSettings> findByName(String name);
    List<RoleSettings> findAllByOrderBySortOrderAsc();
    boolean existsByName(String name);
}
