package com.shmamsa.repository;

import com.shmamsa.model.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByUsername(String username);
    Optional<User> findByEmail(String email);
    java.util.List<User> findByDeaconFamily(String deaconFamily);
    java.util.List<User> findByRoleAndDeaconFamily(String role, String deaconFamily);
    java.util.List<User> findByDeaconFamilyAndRoleIn(String deaconFamily, java.util.List<String> roles);
}

