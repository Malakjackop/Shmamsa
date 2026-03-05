package com.shmamsa.repository;

import com.shmamsa.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByUsername(String username);
    Optional<User> findByEmail(String email);
    Optional<User> findByIdAndUsername(Long id, String username);
    Optional<User> findByNationalId(String nationalId);

    java.util.List<User> findByDeaconFamily(String deaconFamily);
    java.util.List<User> findByRoleAndDeaconFamily(String role, String deaconFamily);
    java.util.List<User> findByDeaconFamilyAndRoleIn(String deaconFamily, java.util.List<String> roles);

    java.util.List<User> findByDeaconFamilyStartingWithAndRoleIn(String prefix, java.util.List<String> roles);

    java.util.List<User> findByRoleIn(java.util.List<String> roles);

    java.util.List<User> findByRoleAndFullNameContainingIgnoreCase(String role, String namePart);

    java.util.List<User> findByRoleAndDeaconFamilyStartingWithAndFullNameContainingIgnoreCase(
            String role,
            String familyPrefix,
            String namePart
    );

    java.util.List<User> findByAttendKhorsAndRoleIn(String attendKhors, java.util.List<String> roles);

    java.util.List<User> findByKhorsAndRoleIn(String khors, java.util.List<String> roles);
    java.util.List<User> findByKhorsInAndRoleIn(java.util.List<String> khors, java.util.List<String> roles);

    // ✅ Multi-family support: find users who belong to this family in any of the 4 family fields
    @Query("""
            select u from User u
            where (lower(u.deaconFamily) like lower(concat(:prefix, '%'))
                or lower(u.deaconFamily2) like lower(concat(:prefix, '%'))
                or lower(u.deaconFamily3) like lower(concat(:prefix, '%'))
                or lower(u.deaconFamily4) like lower(concat(:prefix, '%')))
              and u.role in :roles
            """)
    java.util.List<User> findByAnyFamilyStartingWithAndRoleIn(@Param("prefix") String prefix,
                                                             @Param("roles") java.util.List<String> roles);

}
