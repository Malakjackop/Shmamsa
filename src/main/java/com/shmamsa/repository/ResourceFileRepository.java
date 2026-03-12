package com.shmamsa.repository;

import com.shmamsa.model.ResourceFile;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ResourceFileRepository extends JpaRepository<ResourceFile, Long> {
    List<ResourceFile> findByFamilyIdInOrFamilyOrderByCreatedAtDesc(List<Long> familyIds, String family);

    List<ResourceFile> findAllByOrderByCreatedAtDesc();
}
