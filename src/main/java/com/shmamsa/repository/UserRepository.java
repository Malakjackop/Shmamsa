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

    java.util.List<User> findByRoleIn(java.util.List<String> roles);

    java.util.List<User> findByRoleAndFullNameContainingIgnoreCase(String role, String namePart);

    java.util.List<User> findByAttendKhorsAndRoleIn(String attendKhors, java.util.List<String> roles);

    java.util.List<User> findByKhorsAndRoleIn(String khors, java.util.List<String> roles);
    java.util.List<User> findByKhorsInAndRoleIn(java.util.List<String> khors, java.util.List<String> roles);

    @Query("""
            select distinct u from User u
            join UserFamilyRole ufr on ufr.user.id = u.id
            where ufr.familyId in :familyIds
              and u.role in :roles
            """)
    java.util.List<User> findByAnyFamilyIdInAndRoleIn(@Param("familyIds") java.util.List<Long> familyIds,
                                                      @Param("roles") java.util.List<String> roles);

    @Query("""
            select distinct u from User u
            join UserFamilyRole ufr on ufr.user.id = u.id
            where ufr.familyId in :familyIds
            """)
    java.util.List<User> findByAnyFamilyIdIn(@Param("familyIds") java.util.List<Long> familyIds);

}
