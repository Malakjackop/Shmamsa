package com.shmamsa.repository;

import com.shmamsa.model.UserFamilyRole;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

public interface UserFamilyRoleRepository extends JpaRepository<UserFamilyRole, Long> {
    List<UserFamilyRole> findByUser_IdOrderByAssignmentOrderAscIdAsc(Long userId);

    boolean existsByFamilyId(Long familyId);

    @Modifying
    @Transactional
    void deleteByUser_Id(Long userId);
}
