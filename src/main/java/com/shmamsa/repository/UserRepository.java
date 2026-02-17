package com.shmamsa.repository;

import com.shmamsa.model.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByUsername(String username);
    Optional<User> findByEmail(String email);
    Optional<User> findByIdAndUsername(Long id, String username);

    java.util.List<User> findByDeaconFamily(String deaconFamily);
    java.util.List<User> findByRoleAndDeaconFamily(String role, String deaconFamily);
    java.util.List<User> findByDeaconFamilyAndRoleIn(String deaconFamily, java.util.List<String> roles);

    java.util.List<User> findByDeaconFamilyStartingWithAndRoleIn(String prefix, java.util.List<String> roles);

    // --- Search helpers (used by /api/family/search)
    java.util.List<User> findByRoleAndFullNameContainingIgnoreCase(String role, String namePart);

    java.util.List<User> findByRoleAndDeaconFamilyStartingWithAndFullNameContainingIgnoreCase(
            String role,
            String familyPrefix,
            String namePart
    );
}


